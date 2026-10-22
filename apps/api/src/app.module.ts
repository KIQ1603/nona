import { Module } from '@nestjs/common';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdminCatalogModule } from './modules/admin-catalog/admin-catalog.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DesignsModule } from './modules/designs/designs.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { OrdersModule } from './modules/orders/orders.module';
import { MediaModule } from './modules/media/media.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { DatabaseModule } from './platform/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    IdempotencyModule,
    AuditModule,
    MfaModule,
    AuthModule,
    MediaModule,
    SettingsModule,
    HealthModule,
    CatalogModule,
    AdminCatalogModule,
    InventoryModule,
    CartModule,
    WishlistModule,
    AccountsModule,
    CouponsModule,
    DesignsModule,
    DashboardModule,
    ArticlesModule,
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule {}
