import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

// 【模板输入校验】检查必填、名称长度、金额格式与日期格式；金额关系等业务校验在Service。
export class CreateCouponTemplateDto {
  @IsString() @Length(2, 40) name!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/) minimumSpend!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/) discountAmount!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

// 【发券输入校验】必须有模板ID和合法的提交标识，供后端防重复发券。
export class IssueCouponDto {
  @IsString() @Length(1, 100) templateId!: string;
  @IsUUID('4') requestId!: string;
}

// 【编辑输入校验】沿用模板字段校验，并要求提交读取到的版本号。
export class UpdateCouponTemplateDto extends CreateCouponTemplateDto {
  @IsInt() @Min(1) version!: number;
}

// 【批量输入校验】限定选择模式；手动选择校验ID数组，全选允许传搜索条件。
export class BatchIssueCouponDto extends IssueCouponDto {
  @IsIn(['SELECTED', 'ALL']) mode!: 'SELECTED' | 'ALL';
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @ValidateIf((dto: BatchIssueCouponDto) => dto.mode === 'SELECTED' || dto.memberIds !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  memberIds?: string[];
}

// 【记录筛选】会员共享资料范围，按发放日期与券展示状态服务端分页。
export class ListCouponRecordsDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsString() @MaxLength(100) templateId?: string;
  @IsOptional()
  @IsIn(['AVAILABLE', 'RESERVED', 'USED', 'VOID', 'EXPIRED', 'NOT_STARTED'])
  status?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) startDate?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) endDate?: string;
}
