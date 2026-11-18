import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { PaymentsService } from './payments.service';
export class ListPaymentRecordsDto {
  @IsIn(['payments', 'refunds']) kind: 'payments' | 'refunds' = 'payments';
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsString() @MaxLength(100) memberKeyword?: string;
  @IsOptional() @IsString() @MaxLength(100) storeKeyword?: string;
  @IsOptional() @IsString() @MaxLength(100) orderId?: string;
  @IsOptional() @IsIn(['PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED']) status?: string;
  @IsOptional() @IsIn(['MOCK']) channel?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) startDate?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) endDate?: string;
}
export class PaymentRecordDetailDto {
  @IsIn(['payments', 'refunds']) kind: 'payments' | 'refunds' = 'payments';
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) eventPage = 1;
}
@Controller('payment-records')
export class PaymentRecordsController {
  constructor(private readonly service: PaymentsService) {}
  @Get() @RequirePermissions('order:view') list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPaymentRecordsDto,
  ) {
    return this.service.records(user, query.kind, query.page, query.keyword?.trim() || '', query);
  }
  @Get(':id') @RequirePermissions('order:view') detail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: PaymentRecordDetailDto,
  ) {
    return this.service.recordDetail(user, query.kind, id, query.eventPage);
  }
}
