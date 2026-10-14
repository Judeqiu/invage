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

/** A whole archive from another account is unrelated evidence, not a correction
 * to the selected account. Mixed-account rows within an archive still fail. */
export class BrokerArchiveAccountMismatchError extends Error {
  constructor() {
    super('Archive account mismatch: belongs to a different trading account and was excluded.');
    this.name = 'BrokerArchiveAccountMismatchError';
  }
}
