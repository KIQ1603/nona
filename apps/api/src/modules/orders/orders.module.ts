import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CartModule } from '../cart/cart.module';
import { DesignsModule } from '../designs/designs.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsCoreModule } from '../payments/payments-core.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminOrdersService } from './application/admin-orders.service';
import { OrdersService } from './application/orders.service';
import { OrdersRepository } from './infrastructure/orders.repository';
import { AdminOrdersController } from './presentation/admin-orders.controller';
import { OrdersController } from './presentation/orders.controller';

@Module({
  imports: [
    AccountsModule,
    CartModule,
    SettingsModule,
    CouponsModule,
    DesignsModule,
    PaymentsCoreModule,
  ],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, AdminOrdersService, OrdersRepository],
})
export class OrdersModule {}
