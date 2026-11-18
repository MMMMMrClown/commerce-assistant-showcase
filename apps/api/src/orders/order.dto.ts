import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderSource, OrderStatus } from '@prisma/client';

export enum BenefitMode {
  MEMBER = 'MEMBER',
  NONE = 'NONE',
  COUPON = 'COUPON',
  SECKILL = 'SECKILL',
}

export class OrderItemDto {
  @IsString() @Length(1, 100) productId!: string;
  @IsInt() @Min(1) @Max(20) quantity!: number;
}

export class QuoteOrderDto {
  @IsOptional() @IsEnum(BenefitMode) benefitMode?: BenefitMode;
  @IsOptional() @IsString() @Length(1, 100) couponId?: string;
  // 【秒杀参数校验】活动模式由Service再次限制为单商品、数量1、不叠加券。
  @IsOptional() @IsString() @Length(1, 100) activityId?: string;
  @IsString() @Length(1, 100) storeId!: string;
  @IsString() @Length(1, 100) memberId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class CreateOrderDto extends QuoteOrderDto {
  @IsUUID('4') requestId!: string;
  @IsString() @Length(64, 64) quoteHash!: string;
}

export class ListOrdersDto {
  @IsOptional() @IsString() @MaxLength(100) memberKeyword?: string;
  @IsOptional() @IsString() @MaxLength(100) productKeyword?: string;
  @IsOptional() @IsString() @MaxLength(100) storeKeyword?: string;
  @IsOptional() @IsEnum(OrderSource) source?: OrderSource;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortDirection?: string;
  @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsString() @Length(1, 100) memberId?: string;
  @IsOptional() @IsString() @Length(1, 100) storeId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) startDate?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) endDate?: string;
}
