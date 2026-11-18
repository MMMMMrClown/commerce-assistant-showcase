import { MarketingModule } from './marketing/marketing.module';
import { AgentModule } from './agent/agent.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule, JwtAuthGuard, PermissionGuard } from './auth/auth';
import { OperationLogInterceptor, ResponseInterceptor } from './common/api';
import { ResourcesModule } from './modules/resources';
import { PrismaModule } from './prisma/prisma.module';
import { MembersModule } from './members/member.module';
import { OrdersModule } from './orders/orders.module';
import { CouponsModule } from './coupons/coupons.module';
import { SeckillModule } from './seckill/seckill.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ResourcesModule,
    MembersModule,
    OrdersModule,
    CouponsModule,
    MarketingModule,
    SeckillModule,
    PaymentsModule,
    AgentModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
