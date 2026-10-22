import { Module } from '@nestjs/common';
import { AddressesService } from './application/addresses.service';
import { EmailVerificationService } from './application/email-verification.service';
import { PhoneVerificationService } from './application/phone-verification.service';
import { AddressesController } from './presentation/addresses.controller';
import { EmailController } from './presentation/email.controller';
import { CheckoutPhoneController } from './presentation/checkout-phone.controller';
import { PhoneController } from './presentation/phone.controller';

@Module({
  controllers: [AddressesController, PhoneController, CheckoutPhoneController, EmailController],
  providers: [AddressesService, PhoneVerificationService, EmailVerificationService],
  exports: [PhoneVerificationService, EmailVerificationService],
})
export class AccountsModule {}
