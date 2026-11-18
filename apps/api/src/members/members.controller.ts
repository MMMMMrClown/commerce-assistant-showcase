import { Body, Controller, Get, Post, Query, Param, Patch } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { ListOrdersDto } from '../orders/order.dto';
import { OrdersService } from '../orders/orders.service';
import { CreateMemberDto, UpdateMemberDto } from './member.dto';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(
    private readonly service: MembersService,
    private readonly orders: OrdersService,
  ) {}

  @Get(':id')
  @RequirePermissions('member:view')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Get(':id/orders')
  @RequirePermissions('member:view', 'order:view')
  async memberOrders(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListOrdersDto,
  ) {
    await this.service.detail(id);
    return this.orders.list(user, { ...query, memberId: id });
  }

  @Get()
  @RequirePermissions('member:view')
  list(@Query() query: Record<string, string>) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('member:create')
  create(@Body() dto: CreateMemberDto) {
    return this.service.create(dto);
  }
  @Patch(':id')
  @RequirePermissions('member:edit')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.service.update(id, dto);
  }
}
