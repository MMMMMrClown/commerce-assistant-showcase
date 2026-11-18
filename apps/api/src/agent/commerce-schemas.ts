import { z } from 'zod';
const money = z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
export const productEditSchema = z
  .object({
    productId: z.string().min(1).max(100),
    changes: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        code: z.string().trim().min(1).max(60).optional(),
        imageUrl: z
          .url()
          .max(2000)
          .refine((v) => /^https?:\/\//i.test(v), '图片地址只支持http/https')
          .optional(),
        categoryId: z.string().min(1).max(100).optional(),
        price: money.optional(),
        costPrice: money.optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, '至少修改一个字段'),
  })
  .strict();
export const memberEditSchema = z
  .object({
    memberId: z.string().min(1).max(100),
    changes: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        phone: z
          .string()
          .regex(/^\d{11}$/)
          .optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, '至少修改一个字段'),
  })
  .strict();
export const productCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(100),
    categoryId: z.string().min(1).max(100),
    price: money,
    costPrice: money,
    imageUrl: z
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//i.test(v), '图片地址只支持http/https')
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export const productRenameSchema = z
  .object({ productId: z.string().min(1).max(100), name: z.string().trim().min(1).max(100) })
  .strict();
export const couponTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    minimumSpend: money,
    discountAmount: money,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const couponIssueSchema = z
  .object({
    templateId: z.string().min(1).max(100),
    memberIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  })
  .strict();
export const couponTemplateUpdateSchema = z
  .object({
    templateId: z.string().min(1).max(100),
    changes: couponTemplateSchema
      .partial()
      .refine((c) => Object.keys(c).length > 0, '至少修改一个字段'),
  })
  .strict();
export const couponTemplateDisableSchema = z
  .object({ templateId: z.string().min(1).max(100) })
  .strict();
export const couponVoidSchema = z
  .object({ memberId: z.string().min(1).max(100), couponId: z.string().min(1).max(100) })
  .strict();
export const seckillToggleSchema = z
  .object({ activityId: z.string().min(1).max(100), enabled: z.boolean() })
  .strict();

export const memberCreateSchema = z
  .object({ name: z.string().trim().min(1).max(80), phone: z.string().regex(/^\d{11}$/) })
  .strict();
export const quoteSchema = z
  .object({
    memberId: z.string().min(1).max(100),
    storeId: z.string().min(1).max(100),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    benefitMode: z.enum(['MEMBER', 'NONE', 'COUPON', 'SECKILL']).default('MEMBER'),
    couponId: z.string().max(100).optional(),
    activityId: z.string().max(100).optional(),
  })
  .strict();
export const seckillSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    productId: z.string().min(1).max(100),
    price: z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/),
    stock: z.number().int().min(1).max(100000),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    holdMinutes: z.number().int().min(1).max(30).default(5),
  })
  .strict();
