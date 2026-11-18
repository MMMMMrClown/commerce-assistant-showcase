import { Type, Transform } from 'class-transformer';
import { MemberTier } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MemberTierRuleDto {
  @IsEnum(MemberTier) code!: MemberTier;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  name!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/) minimumSpend!: string;
  @IsInt() @Min(5000) @Max(10000) discountBps!: number;
  @IsInt() @Min(1) @Max(10) pointsPerYuan!: number;
}
export class UpdateBenefitPolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => MemberTierRuleDto)
  tiers!: MemberTierRuleDto[];
  @IsInt() @Min(1) version!: number;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}
export class UpdateMemberTierDto {
  @IsOptional() @IsEnum(MemberTier) tierOverride?: MemberTier | null;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}
export class BenefitPageDto {
  @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 10;
}
