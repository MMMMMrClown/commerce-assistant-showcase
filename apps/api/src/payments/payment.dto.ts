import { IsEnum, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export enum MockOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

// 【模拟结果校验】客户端只能选择结果及当前尝试号，不能传入成交金额或会员权益。
export class MockResultDto {
  @IsEnum(MockOutcome)
  outcome!: MockOutcome;

  @IsInt()
  @Min(1)
  attempt!: number;
}

export class RequestRefundDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}
