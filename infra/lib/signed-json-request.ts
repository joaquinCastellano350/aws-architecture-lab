import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

export interface SignedRequestOptions {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function signedJsonRequest(
  apiUrl: string,
  region: string,
  method: string,
  resourcePath: string,
  options: SignedRequestOptions = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const url = new URL(apiUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${resourcePath}`;
  const headers: Record<string, string> = {
    host: url.host,
    accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: "execute-api",
    sha256: Sha256,
  });
  const port = url.port.length === 0 ? {} : { port: Number(url.port) };
  const requestBody = options.body === undefined ? {} : { body: options.body };
  const signed = await signer.sign(
    new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      ...port,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...requestBody,
    }),
  );
  const response = await fetch(url, {
    method,
    headers: signed.headers,
    ...requestBody,
  });
  const text = await response.text();
  let responseBody: unknown = text;
  try {
    responseBody = JSON.parse(text);
  } catch {
    // Keep non-JSON responses intact for diagnostics.
  }
  return { status: response.status, body: responseBody };
}
