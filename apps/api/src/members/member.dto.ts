import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class CreateMemberDto {
  @IsOptional() @IsString() birthday?: string | null;
  @IsString()
  @IsNotEmpty({ message: '会员姓名不能为空' })
  @Matches(/\S/, { message: '会员姓名不能为空白' })
  name!: string;

  @IsString()
  @Matches(/^\d{11}$/, { message: '手机号必须为11位数字' })
  phone!: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  enabled?: boolean;
}
export class UpdateMemberDto {
  @IsOptional() @IsString() birthday?: string | null;
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty({ message: '会员姓名不能为空' })
  @Matches(/\S/, { message: '会员姓名不能为空白' })
  name?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^\d{11}$/, { message: '手机号必须为11位数字' })
  phone?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  enabled?: boolean;
}
