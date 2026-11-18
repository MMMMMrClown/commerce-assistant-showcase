import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const labels = { region: '区域', store: '门店', user: '账号', role: '角色' };
export function managementWriteError(error: unknown, resource: keyof typeof labels): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const label = labels[resource];
    if (error.code === 'P2002')
      throw new ConflictException({
        code: resource.toUpperCase() + '_IDENTITY_EXISTS',
        message:
          resource === 'user'
            ? '用户名或邮箱已被使用，请核对后重新保存'
            : label + '编码已被使用，请更换编码后保存',
        details: [{ nextAction: 'CHANGE_IDENTITY' }],
      });
    if (error.code === 'P2003')
      throw new BadRequestException({
        code: resource.toUpperCase() + '_REFERENCE_INVALID',
        message: label + '关联的资料不存在，请刷新后重新选择',
        details: [{ nextAction: 'RESELECT_REFERENCE' }],
      });
    if (error.code === 'P2025')
      throw new NotFoundException({
        code: resource.toUpperCase() + '_NOT_FOUND',
        message: label + '不存在或关联资料已变化，请刷新列表后重新选择',
        details: [{ nextAction: 'RELOAD_LIST' }],
      });
  }
  throw error;
}
