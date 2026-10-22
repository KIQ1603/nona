import { Module } from '@nestjs/common';
import { DashboardService } from './application/dashboard.service';
import { DashboardController } from './presentation/dashboard.controller';

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
