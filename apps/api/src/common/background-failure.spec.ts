import { HttpException } from '@nestjs/common';
import { backgroundFailure } from './background-failure';

describe('后台异常日志', () => {
  it('只保留定位信息和稳定错误码', () => {
    expect(
      backgroundFailure(
        'expiry',
        'release',
        new HttpException({ code: 'STOCK_BALANCE_INVALID', message: 'secret SQL' }, 409),
        'o1',
      ),
    ).toEqual({
      event: 'BACKGROUND_TASK_FAILURE',
      task: 'expiry',
      phase: 'release',
      recordId: 'o1',
      code: 'STOCK_BALANCE_INVALID',
    });
  });
  it('不将异常原文或非法错误码输出到日志', () => {
    expect(backgroundFailure('t', 'p', new HttpException('secret', 409)).code).toBe('HTTP_409');
    expect(backgroundFailure('t', 'p', { code: 'password=secret', message: 'SQL' }).code).toBe(
      'UNEXPECTED_ERROR',
    );
    expect(backgroundFailure('t', 'p', { code: 'P2034', message: 'SQL' }).code).toBe('P2034');
  });
});
