import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CategoryDto {
  @IsString()
  @Matches(/\S/, { message: '分类编码不能为空白' })
  code!: string;

  @IsString()
  @Matches(/\S/, { message: '分类名称不能为空白' })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  sort?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
}

export class ProductDto {
  @IsString()
  @Matches(/\S/, { message: '商品编号不能为空白' })
  code!: string;

  @IsString()
  @Matches(/\S/, { message: '商品名称不能为空白' })
  name!: string;

  @IsString()
  @Matches(/\S/, { message: '请选择商品分类' })
  categoryId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: '商品售价须为最多两位小数的数字' })
  @Min(0, { message: '商品售价不能小于0' })
  @Max(9999999999.99, { message: '商品售价不能超过9999999999.99' })
  price!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: '商品成本须为最多两位小数的数字' })
  @Min(0, { message: '商品成本不能小于0' })
  @Max(9999999999.99, { message: '商品成本不能超过9999999999.99' })
  costPrice!: number;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
}

// TypeScript的Partial会丢失运行时校验；仅省略字段可跳过，非空字段传null仍拒绝。
export class UpdateProductDto extends PartialType(ProductDto, { skipNullProperties: false }) {}
export class UpdateCategoryDto extends PartialType(CategoryDto, { skipNullProperties: false }) {}

export class ProductStatusDto {
  @IsBoolean({ message: '商品状态必须为启用或停用' })
  enabled!: boolean;
}
