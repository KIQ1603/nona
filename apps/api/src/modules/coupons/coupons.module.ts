import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CouponsService } from './application/coupons.service';
import { CouponsController } from './presentation/coupons.controller';

@Module({
  imports: [CartModule],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
