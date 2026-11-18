import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// 只翻译已知业务约束；连接/事务等技术异常交给原过滤器，避免误导用户反复改资料。
export function productWriteError(error: unknown, resource: 'product' | 'category'): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ConflictException({
        code: resource === 'product' ? 'PRODUCT_CODE_EXISTS' : 'PRODUCT_CATEGORY_CODE_EXISTS',
        message:
          resource === 'product'
            ? '商品编号已被使用，请更换编号后保存；回收站商品仍保留原编号'
            : '分类编码已被使用，请更换编码后保存',
        details: [{ field: 'code', nextAction: 'CHANGE_CODE' }],
      });
    }
    if (error.code === 'P2003' && resource === 'product') {
      throw new BadRequestException({
        code: 'PRODUCT_CATEGORY_INVALID',
        message: '所选商品分类已不存在，请刷新分类列表后重新选择',
        details: [{ field: 'categoryId', nextAction: 'RESELECT_CATEGORY' }],
      });
    }
    if (error.code === 'P2025') {
      throw new NotFoundException({
        code: resource === 'product' ? 'PRODUCT_NOT_EDITABLE' : 'PRODUCT_CATEGORY_NOT_FOUND',
        message:
          resource === 'product'
            ? '商品不存在或已在回收站，请刷新列表；回收商品需先恢复后编辑'
            : '商品分类已不存在，请刷新分类列表',
        details: [{ nextAction: resource === 'product' ? 'RELOAD_PRODUCT' : 'RELOAD_CATEGORY' }],
      });
    }
  }
  throw error;
}
