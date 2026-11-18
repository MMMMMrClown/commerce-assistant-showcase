import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/auth';
import { CreateSeckillDto, ToggleSeckillDto } from './seckill.dto';
import { SeckillService } from './seckill.service';

@Controller('seckill/activities')
export class SeckillController {
  constructor(private readonly service: SeckillService) {}
  // 【列表接口】运营和有查看权限的员工查看活动。
  @Get()
  @RequirePermissions('seckill:view')
  list() {
    return this.service.list();
  }
  // 【配置接口】只有活动管理权限可以发布秒杀，价格和名额由后端校验。
  @Post()
  @RequirePermissions('seckill:manage')
  create(@Body() dto: CreateSeckillDto) {
    return this.service.create(dto);
  }
  // 【启停接口】不删除交易记录，不改写历史订单规则。
  @Patch(':id')
  @RequirePermissions('seckill:manage')
  toggle(@Param('id') id: string, @Body() dto: ToggleSeckillDto) {
    return this.service.toggle(id, dto.enabled);
  }
}
