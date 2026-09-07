import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

export class MarketplaceCheckoutStack extends Stack {
  public constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
  }
}
