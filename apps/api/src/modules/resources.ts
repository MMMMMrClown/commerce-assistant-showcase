import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma, OrderStatus, ImportStatus } from '@prisma/client';
import { isISO8601, IsInt, IsString, Min, MinLength } from 'class-validator';
import { hash } from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import type { Express } from 'express';
import { adjustStock } from '../orders/product-stock';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthModule,
  CurrentUser,
  DataScopeService,
  Public,
  RequirePermissions,
} from '../auth/auth';
import type { AuthUser } from '../common/api';
import { pagination } from '../common/api';
import {
  CategoryDto,
  ProductDto,
  ProductStatusDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './product.dto';
import { productWriteError } from './product-write-errors';
import { managementWriteError } from './management-write-errors';
import { commerceDateRange } from '../common/commerce-query';
import { importOrderErrors } from './import-rules';
import type { ImportRow, ValidImportRow } from './import-rules';
import {
  EnabledDto,
  RegionDto,
  StoreDto,
  UserDto,
  RoleDto,
  UpdateRegionDto,
  UpdateStoreDto,
  UpdateUserDto,
  UpdateRoleDto,
} from './management.dto';

class StockAdjustmentDto {
  @IsInt() @Min(0) quantity!: number;
  @IsInt() @Min(0) version!: number;
  @IsInt() @Min(0) warning!: number;
  @IsString() @MinLength(1) reason!: string;
  @IsString() @MinLength(16) requestId!: string;
}
@Injectable()
class RegionsService {
  constructor(private readonly prisma: PrismaService) {}
  list(keyword = '') {
    const search = keyword.trim();
    return this.prisma.region.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      include: { _count: { select: { stores: true } } },
      orderBy: { code: 'asc' },
    });
  }
  async create(dto: RegionDto) {
    try {
      return await this.prisma.region.create({ data: dto });
    } catch (error) {
      managementWriteError(error, 'region');
    }
  }
  async update(id: string, dto: UpdateRegionDto) {
    await this.exists(id);
    return this.prisma.region
      .update({ where: { id }, data: dto })
      .catch((error) => managementWriteError(error, 'region'));
  }
  async exists(id: string) {
    if (!(await this.prisma.region.findUnique({ where: { id } })))
      throw new NotFoundException('区域不存在');
  }
}
@Controller('regions')
class RegionsController {
  constructor(private readonly service: RegionsService) {}
  @Get() @RequirePermissions('region:view') list(@Query('keyword') keyword?: string) {
    return this.service.list(keyword);
  }
  @Post() @RequirePermissions('region:create') create(@Body() dto: RegionDto) {
    return this.service.create(dto);
  }
  @Patch(':id') @RequirePermissions('region:edit') update(
    @Param('id') id: string,
    @Body() dto: UpdateRegionDto,
  ) {
    return this.service.update(id, dto);
  }
  @Patch(':id/status') @RequirePermissions('region:edit') status(
    @Param('id') id: string,
    @Body() dto: EnabledDto,
  ) {
    return this.service.update(id, { enabled: dto.enabled });
  }
}

@Injectable()
class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}
  async list(user: AuthUser, query: Record<string, string>) {
    const p = pagination(Number(query.page), Number(query.pageSize));
    const where: Prisma.StoreWhereInput = {
      AND: [
        { deletedAt: null },
        this.scope.storeWhere(user),
        query.keyword
          ? {
              OR: [
                { name: { contains: query.keyword, mode: 'insensitive' } },
                { code: { contains: query.keyword, mode: 'insensitive' } },
              ],
            }
          : {},
        query.regionId ? { regionId: query.regionId } : {},
        query.enabled !== undefined ? { enabled: query.enabled === 'true' } : {},
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.store.findMany({
        where,
        include: {
          region: true,
          manager: { select: { id: true, name: true } },
        },
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.store.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
  async detail(user: AuthUser, id: string) {
    const item = await this.prisma.store.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scope.storeWhere(user)] },
      include: { region: true, manager: { select: { id: true, name: true } } },
    });
    if (!item) throw new NotFoundException('门店不存在');
    return item;
  }
  async create(dto: StoreDto) {
    try {
      return await this.prisma.store.create({
        data: {
          ...dto,
          openedAt: new Date(dto.openedAt),
          managerId: dto.managerId || null,
        },
      });
    } catch (error) {
      managementWriteError(error, 'store');
    }
  }
  async update(id: string, dto: UpdateStoreDto) {
    if (!(await this.prisma.store.findUnique({ where: { id } })))
      throw new NotFoundException('门店不存在');
    try {
      return await this.prisma.store.update({
        where: { id },
        data: {
          ...dto,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : undefined,
          managerId: dto.managerId === undefined ? undefined : dto.managerId || null,
        },
      });
    } catch (error) {
      managementWriteError(error, 'store');
    }
  }
}
@Controller('stores')
class StoresController {
  constructor(private readonly service: StoresService) {}
  @Get() @RequirePermissions('store:view') list(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
  ) {
    return this.service.list(user, query);
  }
  @Get(':id') @RequirePermissions('store:view') detail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.detail(user, id);
  }
  @Post() @RequirePermissions('store:create') create(@Body() dto: StoreDto) {
    return this.service.create(dto);
  }
  @Patch(':id') @RequirePermissions('store:edit') update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.service.update(id, dto);
  }
  @Patch(':id/status') @RequirePermissions('store:edit') status(
    @Param('id') id: string,
    @Body() dto: EnabledDto,
  ) {
    return this.service.update(id, { enabled: dto.enabled });
  }
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}
  categories(keyword = '') {
    const search = keyword.trim();
    return this.prisma.productCategory.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      include: { _count: { select: { products: true } } },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    });
  }
  createCategory(dto: CategoryDto) {
    return this.prisma.productCategory
      .create({ data: dto })
      .catch((error) => productWriteError(error, 'category'));
  }
  updateCategory(id: string, dto: UpdateCategoryDto) {
    return this.prisma.productCategory
      .update({ where: { id }, data: dto })
      .catch((error) => productWriteError(error, 'category'));
  }
  async list(query: Record<string, string>, user: AuthUser) {
    const p = pagination(Number(query.page), Number(query.pageSize));
    const where: Prisma.ProductWhereInput = {
      deletedAt: query.state === 'recycled' ? { not: null } : null,
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled === 'true' } : {}),
    };
    if (query.state === 'warning') {
      const low = await this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "Product" WHERE "deletedAt" IS NULL AND "stockOnHand" IS NOT NULL AND "stockOnHand" - "stockReserved" <= "stockWarning"`;
      where.id = { in: low.map((p) => p.id) };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: { category: true },
        skip: p.skip,
        take: p.take,
        orderBy:
          query.sortBy === 'category'
            ? [
                { category: { name: query.sortDirection === 'asc' ? 'asc' : 'desc' } },
                { id: 'asc' },
              ]
            : [
                {
                  [['name', 'code', 'price', 'costPrice', 'enabled'].includes(query.sortBy)
                    ? query.sortBy
                    : 'createdAt']: query.sortDirection === 'asc' ? 'asc' : 'desc',
                },
                { id: 'asc' },
              ],
      }),
      this.prisma.product.count({ where }),
    ]);
    // 真实净成交件数，遵守当前账号门店范围；整单退款不计入。
    const sales = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: items.map((p) => p.id) },
        order: {
          AND: [
            { deletedAt: null, status: { in: ['PAID', 'COMPLETED'] } },
            this.scope.orderWhere(user),
          ],
        },
      },
      _sum: { quantity: true },
    });
    return {
      items: items.map((item) => ({
        ...item,
        salesQuantity: sales.find((s) => s.productId === item.id)?._sum.quantity || 0,
      })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }
  detail(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
  }
  async stock(id: string, dto: StockAdjustmentDto, user: AuthUser) {
    if (
      !Number.isInteger(dto.quantity) ||
      dto.quantity < 0 ||
      dto.quantity > 1000000000 ||
      !Number.isInteger(dto.version) ||
      dto.version < 0 ||
      !Number.isInteger(dto.warning) ||
      dto.warning < 0 ||
      dto.warning > 1000000000 ||
      typeof dto.reason !== 'string' ||
      !dto.reason.trim() ||
      dto.reason.length > 200 ||
      typeof dto.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,64}$/.test(dto.requestId)
    )
      throw new BadRequestException('库存数量、版本、预警值、原因或提交标识无效');
    return this.prisma.$transaction((tx) =>
      adjustStock(
        tx,
        id,
        dto.quantity,
        dto.version,
        user.id,
        dto.reason.trim(),
        dto.requestId,
        dto.warning,
      ),
    );
  }
  async movements(id: string, query: Record<string, string>) {
    const p = pagination(Number(query.page), 20);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productStockMovement.findMany({
        where: { productId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: 20,
      }),
      this.prisma.productStockMovement.count({ where: { productId: id } }),
    ]);
    return { items, total, page: p.page, pageSize: 20 };
  }
  async recycle(id: string, restore: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
      const p = await tx.product.findUniqueOrThrow({ where: { id } });
      if (
        !restore &&
        (p.stockReserved > 0 ||
          (await tx.seckillActivity.count({
            where: { productId: id, enabled: true, endsAt: { gt: new Date() } },
          })))
      )
        throw new ConflictException('请先关闭有效秒杀活动并处理占用订单');
      return tx.product.update({
        where: { id },
        data: { deletedAt: restore ? null : new Date(), enabled: false },
      });
    });
  }
  create(dto: ProductDto) {
    return this.prisma.product
      .create({ data: dto })
      .catch((error) => productWriteError(error, 'product'));
  }
  update(id: string, dto: UpdateProductDto) {
    const allowed = ['code', 'name', 'categoryId', 'price', 'costPrice', 'imageUrl', 'enabled'];
    if (Object.keys(dto).some((key) => !allowed.includes(key)))
      throw new BadRequestException('商品字段不支持直接修改，请使用对应业务入口');
    return this.prisma.product
      .update({ where: { id, deletedAt: null }, data: dto })
      .catch((error) => productWriteError(error, 'product'));
  }
}
@Controller()
class ProductsController {
  constructor(private readonly service: ProductsService) {}
  @Get('product-categories')
  @RequirePermissions('product-category:view')
  categories(@Query('keyword') keyword?: string) {
    return this.service.categories(keyword);
  }
  @Post('product-categories')
  @RequirePermissions('product-category:edit')
  createCategory(@Body() dto: CategoryDto) {
    return this.service.createCategory(dto);
  }
  @Patch('product-categories/:id')
  @RequirePermissions('product-category:edit')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.updateCategory(id, dto);
  }
  @Get('products') @RequirePermissions('product:view') list(
    @Query() query: Record<string, string>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list(query, user);
  }
  @Post('products/:id/stock') @RequirePermissions('product:edit') stock(
    @Param('id') id: string,
    @Body() dto: StockAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.stock(id, dto, user);
  }
  @Get('products/:id/stock-movements') @RequirePermissions('product:view') movements(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.service.movements(id, query);
  }
  @Post('products/:id/recycle') @RequirePermissions('product:edit') recycle(
    @Param('id') id: string,
  ) {
    return this.service.recycle(id, false);
  }
  @Post('products/:id/restore') @RequirePermissions('product:edit') restore(
    @Param('id') id: string,
  ) {
    return this.service.recycle(id, true);
  }
  @Get('products/:id') @RequirePermissions('product:view') detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
  @Post('products') @RequirePermissions('product:create') create(@Body() dto: ProductDto) {
    return this.service.create(dto);
  }
  @Patch('products/:id') @RequirePermissions('product:edit') update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(id, dto);
  }
  @Patch('products/:id/status') @RequirePermissions('product:edit') status(
    @Param('id') id: string,
    @Body() dto: ProductStatusDto,
  ) {
    return this.service.update(id, { enabled: dto.enabled });
  }
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}
  template() {
    return 'orderNo,storeCode,orderedAt,status,productCode,quantity,unitPrice,discountAmount,paidAmount\nORDER-001,SH001,2026-08-01 09:30:00,COMPLETED,P001,2,32,2,62';
  }
  async preview(user: AuthUser, file: Express.Multer.File) {
    if (!file.originalname.toLowerCase().endsWith('.csv'))
      throw new BadRequestException('只允许上传CSV文件');
    let rows: ImportRow[];
    try {
      rows = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch {
      throw new BadRequestException('CSV文件格式无法解析');
    }
    if (!rows.length || rows.length > 1000) throw new BadRequestException('CSV数据应为1至1000行');
    const requiredColumns = [
      'orderNo',
      'storeCode',
      'orderedAt',
      'status',
      'productCode',
      'quantity',
      'unitPrice',
      'discountAmount',
      'paidAmount',
    ];
    const missingColumns = requiredColumns.filter((key) => !Object.hasOwn(rows[0], key));
    if (missingColumns.length)
      throw new BadRequestException(
        'CSV缺少必需列：' + missingColumns.join('、') + '，请使用导入模板',
      );
    const stores = await this.prisma.store.findMany({
      where: { code: { in: rows.map((r) => r.storeCode) } },
    });
    const products = await this.prisma.product.findMany({
      where: { code: { in: rows.map((r) => r.productCode) } },
    });
    const existing = await this.prisma.order.findMany({
      where: { orderNo: { in: rows.map((r) => r.orderNo) } },
      select: { orderNo: true },
    });
    const storeMap = new Map(stores.map((item) => [item.code, item]));
    const productMap = new Map(products.map((item) => [item.code, item]));
    const existingNos = new Set(existing.map((item) => item.orderNo));
    const valid: ValidImportRow[] = [];
    const validated: { value: ValidImportRow; rowNo: number; rawData: ImportRow }[] = [];
    const errors: {
      rowNo: number;
      field?: string;
      message: string;
      rawData: ImportRow;
    }[] = [];
    rows.forEach((row, index) => {
      const messages: [string, string][] = [];
      if (!row.orderNo) messages.push(['orderNo', '订单号不能为空']);
      if (existingNos.has(row.orderNo)) messages.push(['orderNo', '订单号已经存在']);
      const store = storeMap.get(row.storeCode);
      if (!store?.enabled) messages.push(['storeCode', '门店不存在或已停用']);
      const product = productMap.get(row.productCode);
      if (!product?.enabled) messages.push(['productCode', '商品不存在或已下架']);
      if (!['COMPLETED', 'CANCELED'].includes(row.status))
        messages.push(['status', '状态只能是COMPLETED或CANCELED']);
      const quantity = Number(row.quantity);
      const price = Number(row.unitPrice);
      const discount = Number(row.discountAmount || 0);
      const paid = Number(row.paidAmount);
      if (!Number.isInteger(quantity) || quantity <= 0)
        messages.push(['quantity', '数量必须是正整数']);
      if ([price, discount, paid].some((n) => !Number.isFinite(n) || n < 0))
        messages.push(['amount', '金额必须是有效非负数']);
      if (
        !isISO8601(row.orderedAt.replace(' ', 'T'), { strict: true }) ||
        Number.isNaN(new Date(row.orderedAt).getTime())
      )
        messages.push(['orderedAt', '下单时间格式错误']);
      if (messages.length)
        messages.forEach(([field, message]) =>
          errors.push({ rowNo: index + 2, field, message, rawData: row }),
        );
      else {
        const value = {
          ...row,
          storeId: store!.id,
          productId: product!.id,
          parsedStatus: row.status as OrderStatus,
          parsedQuantity: quantity,
          parsedPrice: price,
          parsedDiscount: discount,
          parsedPaid: paid,
        };
        valid.push(value);
        validated.push({ value, rowNo: index + 2, rawData: row });
      }
    });
    errors.push(...importOrderErrors(validated));
    const failedRows = new Set(errors.map((error) => error.rowNo)).size;
    const task = await this.prisma.dataImport.create({
      data: {
        fileName: file.originalname,
        status: errors.length ? ImportStatus.PREVIEW : ImportStatus.READY,
        totalRows: rows.length,
        successRows: rows.length - failedRows,
        failedRows,
        previewData: rows.slice(0, 20),
        validData: valid,
        createdById: user.id,
        errors: {
          create: errors.map((error) => ({
            rowNo: error.rowNo,
            field: error.field,
            message: error.message,
            rawData: error.rawData,
          })),
        },
      },
      include: { errors: true },
    });
    return task;
  }
  async confirm(id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        // 锁住任务后再检查状态，同批重复确认直接返回结果，不重复创建历史订单。
        await tx.$queryRaw`SELECT "id" FROM "DataImport" WHERE "id" = ${id} FOR UPDATE`;
        const task = await tx.dataImport.findUnique({ where: { id } });
        if (!task) throw new NotFoundException('导入任务不存在');
        if (task.status === ImportStatus.IMPORTED) return;
        if (task.status !== ImportStatus.READY)
          throw new BadRequestException('只有校验全部通过的任务才能导入');
        const rows = task.validData as unknown as ValidImportRow[];
        if (
          importOrderErrors(rows.map((value, i) => ({ value, rowNo: i + 2, rawData: value })))
            .length
        )
          throw new BadRequestException('导入任务的整单数据校验未通过，请重新上传CSV查看错误明细');
        const groups = new Map<string, ValidImportRow[]>();
        rows.forEach((row) => groups.set(row.orderNo, [...(groups.get(row.orderNo) || []), row]));
        const products = await tx.product.findMany({
          where: { id: { in: rows.map((row) => row.productId) } },
          select: { id: true, name: true },
        });
        const names = new Map(products.map((product) => [product.id, product.name]));
        for (const [orderNo, items] of groups) {
          const first = items[0];
          const originalAmount = items.reduce(
            (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).mul(item.parsedQuantity)),
            new Prisma.Decimal(0),
          );
          const discountAmount = new Prisma.Decimal(first.discountAmount || '0');
          await tx.order.create({
            data: {
              orderNo,
              storeId: first.storeId,
              orderedAt: new Date(first.orderedAt),
              status: first.parsedStatus,
              originalAmount,
              discountAmount,
              paidAmount: new Prisma.Decimal(first.paidAmount),
              importId: id,
              source: 'CSV_IMPORT',
              payableAmount: originalAmount.minus(discountAmount),
              items: {
                create: items.map((item) => ({
                  productId: item.productId,
                  productName: names.get(item.productId),
                  productCode: item.productCode,
                  quantity: item.parsedQuantity,
                  unitPrice: new Prisma.Decimal(item.unitPrice),
                  subtotal: new Prisma.Decimal(item.unitPrice).mul(item.parsedQuantity),
                })),
              },
            },
          });
        }
        await tx.dataImport.update({
          where: { id },
          data: { status: ImportStatus.IMPORTED, successRows: rows.length },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'IMPORT_ORDER_EXISTS',
          message: '订单号在预览后已被其他记录使用，本批未导入，请重新上传CSV核对',
          details: [{ nextAction: 'REUPLOAD_IMPORT' }],
        });
      throw error;
    }
    return this.detail(id);
  }
  detail(id: string) {
    return this.prisma.dataImport.findUnique({
      where: { id },
      include: { errors: true, createdBy: { select: { name: true } } },
    });
  }
  async history(query: Record<string, string>) {
    if (query.status && !Object.values(ImportStatus).includes(query.status as ImportStatus))
      throw new BadRequestException('导入状态无效');
    const where: Prisma.DataImportWhereInput = query.status
      ? { status: query.status as ImportStatus }
      : {};
    const p = pagination(Number(query.page), Number(query.pageSize));
    const countsQuery = this.prisma.dataImport.groupBy({ by: ['status'], _count: { _all: true } });
    const [items, total, groups] = await this.prisma.$transaction([
      this.prisma.dataImport.findMany({
        where,
        include: {
          createdBy: { select: { name: true } },
          _count: { select: { errors: true, orders: true } },
        },
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.dataImport.count({ where }),
      countsQuery,
    ]);
    const statusCounts = {
      ...Object.fromEntries(Object.values(ImportStatus).map((s) => [s, 0])),
      ...Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
      '': groups.reduce((sum, g) => sum + g._count._all, 0),
    };
    return { items, total, page: p.page, pageSize: p.pageSize, statusCounts };
  }
}
@Controller('data-imports')
class ImportsController {
  constructor(private readonly service: ImportsService) {}
  @Get('template') @RequirePermissions('data-import:create') template() {
    return {
      content: this.service.template(),
      fileName: 'sunny-coffee-orders-template.csv',
    };
  }
  @Post('upload')
  @RequirePermissions('data-import:create')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipeBuilder().addMaxSizeValidator({ maxSize: 2 * 1024 * 1024 }).build(),
    )
    file: Express.Multer.File,
  ) {
    return this.service.preview(user, file);
  }
  @Post(':id/confirm') @RequirePermissions('data-import:create') confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }
  @Get() @RequirePermissions('data-import:view') history(@Query() query: Record<string, string>) {
    return this.service.history(query);
  }
  @Get(':id') @RequirePermissions('data-import:view') detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}
  private where(user: AuthUser, q: Record<string, string>): Prisma.OrderWhereInput {
    const dates = commerceDateRange(q.startDate, q.endDate);
    const end = dates.lt ? new Date(dates.lt.getTime() - 1) : new Date();
    const start = dates.gte || new Date(end.getTime() - 29 * 86400000);
    if (start > end) throw new BadRequestException('开始日期不能晚于统计结束日期');
    return {
      status: OrderStatus.COMPLETED,
      deletedAt: null,
      AND: [this.scope.orderWhere(user), q.regionId ? { store: { regionId: q.regionId } } : {}],
      ...(q.storeId ? { storeId: q.storeId } : {}),
      orderedAt: {
        gte: start,
        lte: end,
      },
    };
  }
  async overview(user: AuthUser, q: Record<string, string>) {
    const where = this.where(user, q);
    const [aggregate, activeStores, items] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _sum: { paidAmount: true },
        _count: { id: true },
      }),
      this.prisma.store.count({
        where: {
          AND: [
            { enabled: true, deletedAt: null },
            this.scope.storeWhere(user),
            q.regionId ? { regionId: q.regionId } : {},
            q.storeId ? { id: q.storeId } : {},
          ],
        },
      }),
      this.prisma.orderItem.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
    ]);
    // 【真实环比】按当前同长度窗口比较，无上期基数时不展示虚构增幅。
    const range = where.orderedAt as { gte: Date; lte: Date };
    const duration = range.lte.getTime() - range.gte.getTime() + 1;
    const previous = await this.prisma.order.aggregate({
      where: {
        ...where,
        orderedAt: {
          gte: new Date(range.gte.getTime() - duration),
          lte: new Date(range.gte.getTime() - 1),
        },
      },
      _sum: { paidAmount: true },
    });
    const previousRevenue = Number(previous._sum.paidAmount || 0);
    const revenue = Number(aggregate._sum.paidAmount || 0);
    const orderCount = aggregate._count.id;
    return {
      revenue,
      orderCount,
      averageOrderValue: orderCount ? revenue / orderCount : 0,
      activeStores,
      productSales: items._sum.quantity || 0,
      growthRate: previousRevenue
        ? Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(2))
        : null,
    };
  }
  async charts(user: AuthUser, q: Record<string, string>) {
    const orders = await this.prisma.order.findMany({
      where: this.where(user, q),
      include: {
        store: true,
        items: { include: { product: { include: { category: true } } } },
      },
      orderBy: { orderedAt: 'asc' },
    });
    const trend = new Map<string, { date: string; revenue: number; orders: number }>();
    const stores = new Map<string, number>();
    const products = new Map<string, number>();
    const categories = new Map<string, number>();
    const hours = new Map<number, number>();
    orders.forEach((order) => {
      const date = order.orderedAt.toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Shanghai',
      });
      const t = trend.get(date) || { date, revenue: 0, orders: 0 };
      t.revenue += Number(order.paidAmount);
      t.orders += 1;
      trend.set(date, t);
      stores.set(order.store.name, (stores.get(order.store.name) || 0) + Number(order.paidAmount));
      const hour = Number(
        order.orderedAt.toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hourCycle: 'h23',
        }),
      );
      hours.set(hour, (hours.get(hour) || 0) + 1);
      order.items.forEach((item) => {
        products.set(item.product.name, (products.get(item.product.name) || 0) + item.quantity);
        categories.set(
          item.product.category.name,
          (categories.get(item.product.category.name) || 0) + Number(item.subtotal),
        );
      });
    });
    const rank = (map: Map<string, number>, limit = 6) =>
      [...map]
        .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    return {
      trend: [...trend.values()].map((item) => ({
        ...item,
        revenue: Number(item.revenue.toFixed(2)),
      })),
      storeRanking: rank(stores),
      productRanking: rank(products),
      categoryShare: rank(categories),
      hourly: [...hours]
        .map(([hour, value]) => ({ name: `${hour}:00`, value }))
        .sort((a, b) => Number(a.name.split(':')[0]) - Number(b.name.split(':')[0])),
    };
  }
}
@Controller('metrics')
class MetricsController {
  constructor(
    private readonly service: MetricsService,
    private readonly prisma: PrismaService,
  ) {}
  @Get('overview') @RequirePermissions('dashboard:view') overview(
    @CurrentUser() user: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return this.service.overview(user, q);
  }
  @Get('charts') @RequirePermissions('dashboard:view') charts(
    @CurrentUser() user: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return this.service.charts(user, q);
  }
  @Get('definitions') @RequirePermissions('metric:view') definitions() {
    return this.prisma.metricDefinition.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }
  @Patch('definitions/:id/status') @RequirePermissions('metric:edit') status(
    @Param('id') id: string,
    @Body() dto: EnabledDto,
  ) {
    return this.prisma.metricDefinition.update({
      where: { id },
      data: { enabled: dto.enabled },
    });
  }
}

// 账号维护响应统一显式投影，避免密码哈希进入HTTP或工具返回。
const managedUserSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  phone: true,
  enabled: true,
  regionId: true,
  storeId: true,
  region: true,
  store: true,
  roles: { include: { role: true } },
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
class SystemService {
  constructor(private readonly prisma: PrismaService) {}
  users() {
    return this.prisma.user.findMany({
      select: managedUserSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
  async createUser(dto: UserDto) {
    const passwordHash = await hash(dto.password || 'Sunny@123456', 10);
    try {
      return await this.prisma.user.create({
        data: {
          username: dto.username,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          regionId: dto.regionId || null,
          storeId: dto.storeId || null,
          passwordHash,
          roles: dto.roleId ? { create: { roleId: dto.roleId } } : undefined,
        },
        select: { id: true, username: true, name: true },
      });
    } catch (error) {
      managementWriteError(error, 'user');
    }
  }
  async updateUser(id: string, dto: UpdateUserDto) {
    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      enabled: dto.enabled,
      region:
        dto.regionId !== undefined
          ? dto.regionId
            ? { connect: { id: dto.regionId } }
            : { disconnect: true }
          : undefined,
      store:
        dto.storeId !== undefined
          ? dto.storeId
            ? { connect: { id: dto.storeId } }
            : { disconnect: true }
          : undefined,
      ...(dto.password ? { passwordHash: await hash(dto.password, 10) } : {}),
    };
    return this.prisma
      .$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data, select: { id: true } });
        if (dto.roleId) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.create({ data: { userId: id, roleId: dto.roleId } });
        }
        return tx.user.findUniqueOrThrow({ where: { id }, select: managedUserSelect });
      })
      .catch((error) => managementWriteError(error, 'user'));
  }
  roles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  permissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }
  async createRole(dto: RoleDto) {
    return this.prisma.role
      .create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          dataScope: dto.dataScope,
          permissions: dto.permissionIds
            ? {
                create: dto.permissionIds.map((permissionId) => ({
                  permissionId,
                })),
              }
            : undefined,
        },
        include: { permissions: true },
      })
      .catch((error) => managementWriteError(error, 'role'));
  }
  async updateRole(id: string, dto: UpdateRoleDto) {
    return this.prisma
      .$transaction(async (tx) => {
        await tx.role.update({
          where: { id },
          data: {
            code: dto.code,
            name: dto.name,
            description: dto.description,
            dataScope: dto.dataScope,
          },
        });
        if (dto.permissionIds) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          await tx.rolePermission.createMany({
            data: dto.permissionIds.map((permissionId) => ({
              roleId: id,
              permissionId,
            })),
          });
        }
        return tx.role.findUnique({
          where: { id },
          include: { permissions: { include: { permission: true } } },
        });
      })
      .catch((error) => managementWriteError(error, 'role'));
  }
  async logs(q: Record<string, string>) {
    const p = pagination(Number(q.page), Number(q.pageSize));
    const where: Prisma.OperationLogWhereInput = {
      ...(q.keyword
        ? {
            OR: [
              { action: { contains: q.keyword, mode: 'insensitive' } },
              { module: { contains: q.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationLog.findMany({
        where,
        include: { user: { select: { name: true, username: true } } },
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }
}
@Controller('system')
class SystemController {
  constructor(private readonly service: SystemService) {}
  @Get('users') @RequirePermissions('user:view') users() {
    return this.service.users();
  }
  @Post('users') @RequirePermissions('user:edit') createUser(@Body() dto: UserDto) {
    return this.service.createUser(dto);
  }
  @Patch('users/:id') @RequirePermissions('user:edit') updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.service.updateUser(id, dto);
  }
  @Get('roles') @RequirePermissions('role:view') roles() {
    return this.service.roles();
  }
  @Post('roles') @RequirePermissions('role:edit') createRole(@Body() dto: RoleDto) {
    return this.service.createRole(dto);
  }
  @Patch('roles/:id') @RequirePermissions('role:edit') updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.updateRole(id, dto);
  }
  @Get('permissions') @RequirePermissions('role:view') permissions() {
    return this.service.permissions();
  }
  @Get('logs') @RequirePermissions('log:view') logs(@Query() q: Record<string, string>) {
    return this.service.logs(q);
  }
}

@Public()
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [
    RegionsController,
    StoresController,
    ProductsController,
    ImportsController,
    MetricsController,
    SystemController,
    HealthController,
  ],
  exports: [MetricsService],
  providers: [
    RegionsService,
    StoresService,
    ProductsService,
    ImportsService,
    MetricsService,
    SystemService,
  ],
})
export class ResourcesModule {}
