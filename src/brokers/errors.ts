export class BrokerHttpError extends Error {
  readonly errorCode = 'broker_http' as const;
  constructor(
    message: string,
    readonly vendorCode?: string,
  ) {
    super(message);
    this.name = 'BrokerHttpError';
  }
}

export class BrokerParseError extends Error {
  readonly errorCode = 'broker_parse' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BrokerParseError';
  }
}
