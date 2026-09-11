import {
  InvokeCommand,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import {
  validateFulfillmentCommandOutcome,
  type FulfillmentCommandOutcome,
  type HandoffFulfillmentCommand,
} from "@aws-architecture-lab/contracts";

export interface FulfillmentLambdaClient {
  send(command: InvokeCommand): Promise<InvokeCommandOutput>;
}

export class LambdaFulfillmentHandoffExecutor {
  constructor(
    private readonly functionArn: string,
    private readonly client: FulfillmentLambdaClient,
  ) {}

  async execute(command: HandoffFulfillmentCommand): Promise<FulfillmentCommandOutcome> {
    const response = await this.client.send(new InvokeCommand({
      FunctionName: this.functionArn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(command)),
    }));
    if (
      response.FunctionError !== undefined ||
      response.StatusCode !== 200 ||
      response.Payload === undefined
    ) {
      throw new Error("Fulfillment command invocation failed");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(response.Payload));
    } catch {
      throw new Error("Fulfillment command invocation returned invalid JSON");
    }
    const validation = validateFulfillmentCommandOutcome(payload);
    if (!validation.ok) {
      throw new Error("Fulfillment command invocation returned an invalid outcome");
    }
    return validation.value;
  }
}
