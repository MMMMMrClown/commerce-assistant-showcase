import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SeckillController } from './seckill.controller';
import { SeckillService } from './seckill.service';

@Module({
  imports: [OrdersModule],
  controllers: [SeckillController],
  providers: [SeckillService],
  exports: [SeckillService],
})
export class SeckillModule {}
