import { PartialType } from '@nestjs/swagger';
import { DataScope } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class EnabledDto {
  @IsBoolean({ message: '状态必须为启用或停用' })
  enabled!: boolean;
}
export class RegionDto {
  @IsString() @Matches(/\S/) code!: string;
  @IsString() @Matches(/\S/) name!: string;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() enabled?: boolean;
}
export class StoreDto {
  @IsString() @Matches(/\S/) code!: string;
  @IsString() @Matches(/\S/) name!: string;
  @IsString() @Matches(/\S/) regionId!: string;
  @IsString() @Matches(/\S/) address!: string;
  @ValidateIf((_o, v) => v != null) @IsString() managerId?: string | null;
  @ValidateIf((_o, v) => v != null) @IsString() phone?: string | null;
  @IsDateString() openedAt!: string;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() enabled?: boolean;
}
export class UserDto {
  @IsString() @Matches(/\S/) username!: string;
  @IsString() @Matches(/\S/) name!: string;
  @ValidateIf((_o, v) => v != null) @IsEmail() email?: string | null;
  @ValidateIf((_o, v) => v != null) @IsString() phone?: string | null;
  @ValidateIf((_o, v) => v != null) @IsString() regionId?: string | null;
  @ValidateIf((_o, v) => v != null) @IsString() storeId?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsString() roleId?: string;
  // 原表单空密码表示保持原密码；新增时仍沿用原默认密码策略。
  @ValidateIf((_o, v) => v !== undefined && v !== '') @IsString() @MinLength(8) password?: string;
}
export class RoleDto {
  @IsString() @Matches(/\S/) code!: string;
  @IsString() @Matches(/\S/) name!: string;
  @ValidateIf((_o, v) => v != null) @IsString() description?: string | null;
  @IsEnum(DataScope) dataScope!: DataScope;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  permissionIds?: string[];
}
export class UpdateRegionDto extends PartialType(RegionDto, { skipNullProperties: false }) {}
export class UpdateStoreDto extends PartialType(StoreDto, { skipNullProperties: false }) {}
export class UpdateRoleDto extends PartialType(RoleDto, { skipNullProperties: false }) {}
export class UpdateUserDto extends PartialType(UserDto, { skipNullProperties: false }) {
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() enabled?: boolean;
}
