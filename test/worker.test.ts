import { describe, expect, it } from "vitest";
import { createSignedCalcRequest, handleRequest } from "../src/index";

const SHARED_SECRET = "test-secret";
const ENV = {
  LILIUM_COMMAND_CONFIG_ID: "calc",
  LILIUM_SHARED_SECRET: SHARED_SECRET,
} as const satisfies Env & { LILIUM_SHARED_SECRET: string };

type CommandResult = {
  status: "ok" | "rejected";
  effects: Array<{
    text: string;
  }>;
};

function envelope(args: string) {
  return {
    api_version: "lilium.external-command.v1",
    type: "command.invoke",
    invocation_id: "cmd_test",
    sent_at: "2026-05-16T00:00:00Z",
    command: {
      config_id: "calc",
      name: "/calc",
      matched_name: "/calc",
      args,
    },
    chat: {
      platform: "lilium",
      room_id: "room_test",
      room_type: "group",
    },
    sender: {
      user_id: "user_test",
      display_name: "Tester",
    },
    message: {
      message_id: "msg_test",
      text: `/calc ${args}`,
      created_at: "2026-05-16T00:00:00Z",
    },
  };
}

describe("handleRequest", () => {
  it("returns a Lilium command result for signed calc invocations", async () => {
    const request = await createSignedCalcRequest(
      "https://worker.example.com/api/lilium/external-commands/v1/calc/invoke",
      SHARED_SECRET,
      envelope("1 + 2 * (3 + 4)"),
    );

    const response = await handleRequest(request, ENV);
    const payload = (await response.json()) as CommandResult;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      api_version: "lilium.external-command.v1",
      type: "command.result",
      invocation_id: "cmd_test",
      status: "ok",
      effects: [
        {
          type: "reply",
          text: "1 + 2 * (3 + 4) = 15",
          markdown: false,
        },
      ],
    });
  });

  it("returns rejected command result for invalid expressions", async () => {
    const request = await createSignedCalcRequest(
      "https://worker.example.com/api/lilium/external-commands/v1/calc/invoke",
      SHARED_SECRET,
      envelope("1 / 0"),
    );

    const response = await handleRequest(request, ENV);
    const payload = (await response.json()) as CommandResult;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("rejected");
    expect(payload.effects[0].text).toContain("division by zero");
  });

  it("rejects requests when the signed body is changed", async () => {
    const request = await createSignedCalcRequest(
      "https://worker.example.com/api/lilium/external-commands/v1/calc/invoke",
      SHARED_SECRET,
      envelope("1 + 2"),
    );
    const tampered = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(envelope("2 + 2")),
    });

    const response = await handleRequest(tampered, ENV);

    expect(response.status).toBe(400);
  });
});
