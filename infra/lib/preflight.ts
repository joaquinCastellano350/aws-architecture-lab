export interface CallerIdentity {
  readonly account: string;
  readonly arn: string;
}

export interface PreflightDependencies {
  readonly getCallerIdentity: () => CallerIdentity;
  readonly write: (message: string) => void;
}

export type PaymentProviderMode = "fake" | "stripe-sandbox";

export interface PreflightReport {
  readonly account: string;
  readonly providerMode: PaymentProviderMode;
  readonly region: string;
  readonly requestCeiling: number;
}

export function runPreflight(
  environment: NodeJS.ProcessEnv,
  dependencies: PreflightDependencies,
): PreflightReport {
  let identity: CallerIdentity;
  try {
    identity = dependencies.getCallerIdentity();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`AWS credentials are missing or unusable: ${reason}`, { cause: error });
  }

  const expectedAccount = environment.AWS_SANDBOX_ACCOUNT_ID ?? "";
  if (identity.account !== expectedAccount) {
    throw new Error(
      `AWS credentials resolve to account ${identity.account}, expected sandbox account ${expectedAccount}.`,
    );
  }

  const region = environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION ?? "";
  if (region !== "us-east-1") {
    throw new Error(`AWS region must be us-east-1; received ${region || "no region"}.`);
  }

  const providerMode = environment.PAYMENT_PROVIDER_MODE ?? "";
  if (providerMode !== "fake" && providerMode !== "stripe-sandbox") {
    throw new Error(
      `PAYMENT_PROVIDER_MODE must be fake or stripe-sandbox; received ${providerMode || "no value"}.`,
    );
  }

  const requestCeiling = Number(environment.CHECKOUT_REQUEST_CEILING);
  if (!Number.isInteger(requestCeiling) || requestCeiling < 1 || requestCeiling > 9000) {
    throw new Error("CHECKOUT_REQUEST_CEILING must be an integer from 1 through 9000.");
  }

  const budgetNotificationEmail = environment.BUDGET_NOTIFICATION_EMAIL ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(budgetNotificationEmail)) {
    throw new Error("BUDGET_NOTIFICATION_EMAIL must contain a valid email address.");
  }

  dependencies.write(
    `Preflight passed for ${identity.account} in ${region} (${providerMode}, ceiling ${requestCeiling}).`,
  );

  return {
    account: identity.account,
    providerMode,
    region,
    requestCeiling,
  };
}
