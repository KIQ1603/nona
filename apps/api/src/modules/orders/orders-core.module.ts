import { Module } from '@nestjs/common';
import { OrdersRepository } from './infrastructure/orders.repository';

/** Persistence for orders, shared by the orders and payments modules (avoids a dependency cycle). */
@Module({ providers: [OrdersRepository], exports: [OrdersRepository] })
export class OrdersCoreModule {}
