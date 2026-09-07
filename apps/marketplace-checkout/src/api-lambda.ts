import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { CheckoutApplication, createCheckoutApiHandler } from "./checkout-api.js";
import { DynamoCheckoutPersistence } from "./dynamo-checkout-persistence.js";
import { requiredEnvironment } from "./environment.js";
import { StepFunctionsWorkflowStarter } from "./step-functions-workflow-starter.js";

const orderTableName = requiredEnvironment("ORDER_TABLE_NAME");
const sagaTableName = requiredEnvironment("SAGA_TABLE_NAME");
const workflowAliasArn = requiredEnvironment("WORKFLOW_ALIAS_ARN");

const application = new CheckoutApplication({
  persistence: new DynamoCheckoutPersistence(orderTableName, sagaTableName),
  workflow: new StepFunctionsWorkflowStarter(workflowAliasArn),
});
const api = createCheckoutApiHandler(application);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return api({
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    body: event.body,
  });
}
