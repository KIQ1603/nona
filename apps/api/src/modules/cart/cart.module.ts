import { Module } from '@nestjs/common';
import { DesignsModule } from '../designs/designs.module';
import { CartService } from './application/cart.service';
import { CartRepository } from './infrastructure/cart.repository';
import { CartController } from './presentation/cart.controller';

@Module({
  imports: [DesignsModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartService, CartRepository],
})
export class CartModule {}
