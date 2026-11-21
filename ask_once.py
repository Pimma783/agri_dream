"""Run one representative F3 question and show the tool trace and token usage."""
from agent import agent


if __name__ == "__main__":
    result = agent("มีฟางข้าว 3 ตันที่นครสวรรค์ มีโรงงานไหนรับซื้อบ้าง?")
    print()
    for message in agent.messages:
        for block in message["content"]:
            if "toolUse" in block:
                call = block["toolUse"]
                print("TOOL CALLED:", call["name"], call["input"])
    usage = result.metrics.accumulated_usage
    print("TOKENS:", usage["inputTokens"], "in,", usage["outputTokens"], "out")
