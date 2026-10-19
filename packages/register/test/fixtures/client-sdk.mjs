// PayPal's official server SDK, pointed at the sandbox exactly as a real app would be.
import { CheckoutPaymentIntent, Client, Environment, OrdersController } from '@paypal/paypal-server-sdk';

const client = new Client({
  clientCredentialsAuthCredentials: { oAuthClientId: 'test-id', oAuthClientSecret: 'test-secret' },
  environment: Environment.Sandbox,
  timeout: 5000,
});
const { result } = await new OrdersController(client).createOrder({
  body: {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [{ amount: { currencyCode: 'USD', value: '5.00' } }],
  },
});

console.log(JSON.stringify({ orderId: result.id }));
