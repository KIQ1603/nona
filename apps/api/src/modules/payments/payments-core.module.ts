import { Module } from '@nestjs/common';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { PaymentGateway } from './application/payment-gateway';
import { RefundsService } from './application/refunds.service';
import { SettlementService } from './application/settlement.service';

@Module({
  imports: [OrdersCoreModule],
  providers: [PaymentGateway, RefundsService, SettlementService],
  exports: [PaymentGateway, RefundsService, SettlementService, OrdersCoreModule],
})
export class PaymentsCoreModule {}
