import { Module } from '@nestjs/common';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { PaymentsService } from './application/payments.service';
import { SystemService } from './application/system.service';
import { VnpaySimulatorController } from './dev/vnpay-simulator';
import { PaymentsController } from './presentation/payments.controller';
import { InternalGuard } from './presentation/internal.guard';
import { PaymentsCoreModule } from './payments-core.module';
import { SystemController } from './presentation/system.controller';

@Module({
  imports: [PaymentsCoreModule, OrdersCoreModule],
  controllers: [PaymentsController, SystemController, VnpaySimulatorController],
  providers: [PaymentsService, SystemService, InternalGuard],
})
export class PaymentsModule {}
