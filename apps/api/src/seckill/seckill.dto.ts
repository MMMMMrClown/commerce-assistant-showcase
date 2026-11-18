import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// 【活动输入校验】固定商品、活动价、独立名额和时间；首版只支持每会员限购1件。
export class CreateSeckillDto {
  @IsString() @Length(2, 40) name!: string;
  @IsString() @Length(1, 100) productId!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/) price!: string;
  @IsInt() @Min(1) @Max(100000) stock!: number;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsInt() @Min(1) @Max(30) holdMinutes: number = 5;
}
export class ToggleSeckillDto {
  @IsBoolean() enabled!: boolean;
}
