"""AgriCarbon Match AI's first Strands agent for the F3 matching demo."""
from strands import Agent, tool
from strands.models import BedrockModel

from matching import find_biomass_buyers as match_buyers

SYSTEM_PROMPT = (
    "คุณคือ AgriCarbon Match AI ผู้ช่วยเกษตรกรค้นหาโรงงานรับซื้อวัสดุเหลือใช้ในพื้นที่นำร่อง "
    "ตอบเป็นภาษาไทยแบบสั้น เมื่อผู้ใช้ขอจับคู่ ให้ถามเฉพาะข้อมูลที่ขาด ได้แก่ ชนิดวัสดุ "
    "ปริมาณเป็นตัน และจังหวัดจุดรับ หากให้หน่วยอื่น ให้ขอปริมาณเป็นตันโดยไม่เดาอัตราแปลง "
    "เมื่อข้อมูลครบ ให้เรียก find_biomass_buyers และใช้ผลจากเครื่องมือเท่านั้น "
    "แสดงชื่อโรงงาน ระยะทางเป็นกิโลเมตร และราคาจำลองเป็นบาทต่อตันตามลำดับที่เครื่องมือส่งคืน "
    "ถ้าไม่พบโรงงาน ให้บอกว่าไม่พบโรงงานที่ตรงเงื่อนไขและชวนแก้ข้อมูล "
    "ห้ามรับประกันราคา การรับซื้อ หรือรายได้"
)




find_biomass_buyers = tool(match_buyers)

agent = Agent(
    model=BedrockModel(
        model_id="anthropic.claude-sonnet-5",
        region_name="ap-southeast-1",
        max_tokens=600,
    ),
    system_prompt=SYSTEM_PROMPT,
    tools=[find_biomass_buyers],
)


if __name__ == "__main__":
    print("AgriCarbon Match AI · พิมพ์ exit เพื่อออก")
    while True:
        try:
            question = input("\nคุณ > ").strip()
        except EOFError:
            break
        if question.lower() in {"exit", "quit"}:
            break
        if question:
            agent(question)
            print()
