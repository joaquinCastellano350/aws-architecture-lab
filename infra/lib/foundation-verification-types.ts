export interface FoundationVerificationDependencies {
  readonly runAwsJson: (args: readonly string[]) => unknown;
  readonly write: (message: string) => void;
}

export interface FoundationVerificationReport {
  readonly resourceCount: number;
  readonly stackStatus: string;
}

export interface DeployedBoundary {
  readonly policyArn: string;
  readonly roleName: string;
}
