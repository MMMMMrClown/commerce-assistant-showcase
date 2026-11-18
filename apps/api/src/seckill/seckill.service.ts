import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { backgroundFailure } from '../common/background-failure';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateSeckillDto } from './seckill.dto';

@Injectable()
export class SeckillService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private expiryCursor: { expiresAt: Date; id: string } | null = null;
  private readonly logger = new Logger(SeckillService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    // 【自动到期处理】启动即扫描，之后每15秒扫描；占用记录持久化，重启后仍能恢复释放。
    const run = () => {
      void this.releaseExpired().catch((error) =>
        this.logger.warn(backgroundFailure('order-expiry', 'scan', error)),
      );
    };
    run();
    this.timer = setInterval(run, 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  list() {
    // 【活动查询】展示活动和商品；实际购买还会检查商品启停、门店范围和会员身份。
    return this.prisma.seckillActivity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { name: true, imageUrl: true, price: true, enabled: true } } },
    });
  }

  async create(dto: CreateSeckillDto) {
    // 【业务校验】金额大于0且不高于商品现价；结束时间晚于开始和当前时间。
    const startsAt = new Date(dto.startsAt),
      endsAt = new Date(dto.endsAt),
      price = new Prisma.Decimal(dto.price);
    if (dto.name.trim().length < 2 || price.lte(0) || startsAt >= endsAt || endsAt <= new Date())
      throw new BadRequestException('活动名称、价格或时间范围不正确');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${dto.productId} FOR UPDATE`;
      const product = await tx.product.findFirst({
        where: { id: dto.productId, enabled: true, deletedAt: null, category: { enabled: true } },
      });
      if (!product || price.gt(product.price))
        throw new BadRequestException('商品不可用或秒杀价高于商品现价');
      // 【活动写入】独立库存初始等于总名额；首版不修改已发布的价格、时间和总量。
      return tx.seckillActivity.create({
        data: { ...dto, name: dto.name.trim(), price, startsAt, endsAt, remainingStock: dto.stock },
      });
    });
  }

  async toggle(id: string, enabled: boolean) {
    // 【活动启停】停止新报价和新下单，已创建订单仍按原截止时间处理。
    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.seckillActivity.findUnique({ where: { id } });
      if (!activity) throw new NotFoundException('秒杀活动不存在');
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${activity.productId} FOR UPDATE`;
      const product = await tx.product.findUniqueOrThrow({ where: { id: activity.productId } });
      if (enabled && (product.deletedAt || !product.enabled))
        throw new BadRequestException('商品已回收或下架，不能启用活动');
      await tx.seckillActivity.update({ where: { id }, data: { enabled } });
      return { id, enabled };
    });
  }

  async releaseExpired() {
    // 【任务防重入】单实例避免重复扫描；多实例由订单条件更新和事务保证只释放一次。
    if (this.running) return 0;
    this.running = true;
    try {
      const cutoff = new Date();
      const load = () =>
        this.prisma.order.findMany({
          where: {
            status: 'PENDING_PAYMENT',
            source: 'BACKOFFICE',
            expiresAt: { lte: cutoff },
            ...(this.expiryCursor
              ? {
                  OR: [
                    { expiresAt: { gt: this.expiryCursor.expiresAt } },
                    { expiresAt: this.expiryCursor.expiresAt, id: { gt: this.expiryCursor.id } },
                  ],
                }
              : {}),
          },
          select: { id: true, expiresAt: true },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: 100,
        });
      // 【公平扫描】游标跨批推进，扫到末尾后回绕；异常记录保留，回绕后再重试。
      let due = await load();
      if (!due.length && this.expiryCursor) {
        this.expiryCursor = null;
        due = await load();
      }
      const last = due.at(-1);
      if (last?.expiresAt) this.expiryCursor = { id: last.id, expiresAt: last.expiresAt };
      let count = 0;
      for (const order of due) {
        try {
          count += await this.orders.expireSeckillOrder(order.id);
        } catch (error) {
          this.logger.warn(backgroundFailure('order-expiry', 'expire-order', error, order.id));
        }
      }
      return count;
    } finally {
      this.running = false;
    }
  }
}
