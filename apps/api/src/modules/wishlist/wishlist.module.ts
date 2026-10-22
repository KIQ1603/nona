import { Module } from '@nestjs/common';
import { WishlistService } from './application/wishlist.service';
import { WishlistController } from './presentation/wishlist.controller';

@Module({ controllers: [WishlistController], providers: [WishlistService] })
export class WishlistModule {}
