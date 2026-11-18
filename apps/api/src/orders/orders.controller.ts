import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { CreateOrderDto, ListOrdersDto, QuoteOrderDto } from './order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  @RequirePermissions('order:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('order:view')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.detail(user, id);
  }

  @Post('quote')
  @RequirePermissions('order:create')
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteOrderDto) {
    return this.service.quote(user, dto);
  }

  @Post()
  @RequirePermissions('order:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.service.create(user, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('order:cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }

  @Post(':id/ship')
  @RequirePermissions('order:view', 'order:fulfill')
  ship(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.fulfill(user, id, 'ship');
  }

  @Post(':id/receive')
  @RequirePermissions('order:view', 'order:fulfill')
  receive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.fulfill(user, id, 'receive');
  }
}
