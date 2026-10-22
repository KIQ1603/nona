import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { addressInputSchema, updateAddressSchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { AddressesService } from '../application/addresses.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });

@Controller('me/addresses')
@Authenticated()
export class AddressesController {
  constructor(@Inject(AddressesService) private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.addresses.list(auth.userId);
  }

  @Post()
  create(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.addresses.create(auth.userId, parseInput(addressInputSchema, body));
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.addresses.update(auth.userId, id, parseInput(updateAddressSchema, body));
  }

  @Delete(':id')
  remove(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) {
    return this.addresses.remove(auth.userId, id);
  }
}
