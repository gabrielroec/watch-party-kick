import type { CreateRoomResponse } from "@wpk/shared";
import { isCreateRoomResponse } from "@wpk/shared";
import { BACKEND_URL } from "./config";

export async function createRoom(code: string): Promise<CreateRoomResponse> {
  const response = await fetch(`${BACKEND_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.toUpperCase() }),
  });
  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }
  const body = await response.json();
  if (!isCreateRoomResponse(body)) {
    throw new Error("backend response missing host fields");
  }
  return body;
}
