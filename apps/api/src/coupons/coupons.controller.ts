import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import {
  BatchIssueCouponDto,
  ListCouponRecordsDto,
  CreateCouponTemplateDto,
  IssueCouponDto,
  UpdateCouponTemplateDto,
} from './coupon.dto';
import { CouponsService } from './coupons.service';

// 【接口入口】按请求方法和路径调用对应业务；每个入口检查查看/发券权限。
@Controller('coupons')
export class CouponsController {
  constructor(private readonly service: CouponsService) {}
  // 【统一发放记录】不包含关联订单和资金明细，沿用会员查看权限。
  @Get('records') @RequirePermissions('member:view') records(@Query() query: ListCouponRecordsDto) {
    return this.service.records(query);
  }
  // 【查询模板接口】供发券下拉框和模板管理使用。
  @Get('templates')
  @RequirePermissions('member:view', 'member:coupon-issue')
  templates() {
    return this.service.templates();
  }

  // 【新建模板接口】接收规则表单，交给Service校验并保存。
  @Post('templates')
  @RequirePermissions('member:view', 'member:coupon-issue')
  createTemplate(@Body() dto: CreateCouponTemplateDto) {
    return this.service.createTemplate(dto);
  }

  // 【修改模板接口】携带旧版本，发布新版本，保留已发券的原规则。
  @Patch('templates/:id')
  @RequirePermissions('member:view', 'member:coupon-issue')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateCouponTemplateDto) {
    return this.service.updateTemplate(id, dto);
  }

  // 【删除模板接口】停止后续发放，不删除会员已持有的券。
  @Delete('templates/:id')
  @RequirePermissions('member:view', 'member:coupon-issue')
  deleteTemplate(@Param('id') id: string) {
    return this.service.deleteTemplate(id);
  }

  // 【批量发券接口】接收勾选会员ID或全选搜索条件，以及模板和提交标识。
  @Post('batches')
  @RequirePermissions('member:view', 'member:coupon-issue')
  batch(@CurrentUser() user: AuthUser, @Body() dto: BatchIssueCouponDto) {
    return this.service.issueBatch(user, dto);
  }

  // 【单张券作废接口】只允许作废未被订单占用、未核销的会员券。
  @Delete('members/:id/coupons/:couponId')
  @RequirePermissions('member:view', 'member:coupon-issue')
  voidCoupon(@Param('id') id: string, @Param('couponId') couponId: string) {
    return this.service.voidCoupon(id, couponId);
  }

  // 【会员券查询接口】给会员弹窗展示和下单选券使用。
  @Get('members/:id')
  @RequirePermissions('member:view')
  list(@Param('id') id: string) {
    return this.service.list(id);
  }

  // 【单人发券接口】接收会员ID、模板ID和防重复提交标识。
  @Post('members/:id')
  @RequirePermissions('member:view', 'member:coupon-issue')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: IssueCouponDto) {
    return this.service.issue(user, id, dto);
  }
}
