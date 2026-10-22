import { Module } from '@nestjs/common';
import { MfaService } from './application/mfa.service';
import { MfaController } from './presentation/mfa.controller';

@Module({ controllers: [MfaController], providers: [MfaService], exports: [MfaService] })
export class MfaModule {}
