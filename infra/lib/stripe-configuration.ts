const stripeEventBusPrefix = "aws.partner/stripe.com/";

export function requiredStripeEventBusName(environment: NodeJS.ProcessEnv): string {
  const name = environment.STRIPE_EVENT_BUS_NAME;
  if (name === undefined || !name.startsWith(stripeEventBusPrefix)) {
    throw new Error(
      "STRIPE_EVENT_BUS_NAME is required for stripe-sandbox and must name a Stripe partner bus.",
    );
  }
  return name;
}
