import { ConflictException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { toolError } from './tool-error';
describe('新增工具错误分类', () => {
  it('保留库存恢复指引，丢弃手机号、任意指令等非白名单详情', () => {
    const result = toolError(
      new ConflictException({
        code: 'STOCK_INSUFFICIENT',
        message: '库存不足',
        details: [{ nextAction: 'REQUOTE', phone: '19900000001' }, { nextAction: 'send-secret' }],
      }),
    );
    expect(result).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      nextActions: ['REQUOTE'],
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain('19900000001');
    expect(JSON.stringify(result)).not.toContain('send-secret');
    expect(
      toolError(new InternalServerErrorException({ code: 'SECRET', message: 'secret' })),
    ).toMatchObject({ code: 'BUSINESS_UNAVAILABLE', message: '业务服务暂不可用，请稍后重试' });
  });
  it('保留业务冲突原因，便于继续补问', () => {
    expect(toolError(new ConflictException('手机号已存在'))).toMatchObject({
      code: 'CONFLICT',
      message: '手机号已存在',
      retryable: false,
    });
  });
  it('资源不存在不一律归类成会员不存在', () => {
    expect(toolError(new NotFoundException('商品不存在')).code).toBe('NOT_FOUND');
  });
  it('未知异常不泄露底层信息', () => {
    expect(JSON.stringify(toolError(new Error('postgresql://private')))).not.toContain(
      'postgresql',
    );
  });
});
