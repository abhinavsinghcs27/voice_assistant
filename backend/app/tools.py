import re
import uuid
import time
import random
from typing import Dict, Any, List, Optional

# =====================================================================
# 1. E-Commerce Live Order & Logistics Database
# =====================================================================
ORDER_DATABASE: Dict[str, Dict[str, Any]] = {
    "ORD-1092": {
        "order_id": "ORD-1092",
        "customer_name": "Rohan Sharma",
        "product": "Sony WH-1000XM5 Wireless Headphones",
        "status": "Out for Delivery",
        "carrier": "BlueDart Express",
        "tracking_number": "BD-883920194",
        "current_location": "Noida Sector 62 Hub",
        "dispatched_at": "Yesterday 4:30 PM",
        "estimated_delivery": "Today by 6:00 PM",
        "delivery_agent": "Amit Kumar (+91-98112-XXXXX)",
        "destination_city": "Noida, UP"
    },
    "ORD-4821": {
        "order_id": "ORD-4821",
        "customer_name": "Pooja Verma",
        "product": "Samsung 55-inch Crystal 4K UHD Smart TV",
        "status": "In Transit",
        "carrier": "Delhivery Logistics",
        "tracking_number": "DEL-492019382",
        "current_location": "Gurugram Central Sorting Facility",
        "dispatched_at": "Today 08:15 AM",
        "estimated_delivery": "Tomorrow by 2:00 PM",
        "delivery_agent": "Assigned upon arrival at local hub",
        "destination_city": "Delhi NCR"
    },
    "ORD-7741": {
        "order_id": "ORD-7741",
        "customer_name": "Vikas Singh",
        "product": "Bosch 7kg Front Load Washing Machine",
        "status": "Dispatched",
        "carrier": "Shadowfax Express",
        "tracking_number": "SFX-11928472",
        "current_location": "Bhiwandi Mother Warehouse",
        "dispatched_at": "Today 11:30 AM",
        "estimated_delivery": "October 7th by 5:00 PM",
        "delivery_agent": "Pending local hub dispatch",
        "destination_city": "Jaipur, Rajasthan"
    },
    "ORD-9821": {
        "order_id": "ORD-9821",
        "customer_name": "Ananya Patel",
        "product": "Apple iPad Air 11-inch M2",
        "status": "Out for Delivery",
        "carrier": "BlueDart Express",
        "tracking_number": "BD-90481237",
        "current_location": "Ahmedabad South Hub",
        "dispatched_at": "Today 07:00 AM",
        "estimated_delivery": "Today by 4:30 PM",
        "delivery_agent": "Suresh Patel (+91-98790-XXXXX)",
        "destination_city": "Ahmedabad, Gujarat"
    }
}


def lookup_order(order_id: str) -> Dict[str, Any]:
    """
    Simulated live e-commerce carrier dispatch lookup.
    """
    clean_id = str(order_id).strip().upper().replace(" ", "").replace("#", "")
    
    # Try exact match or match digits
    if clean_id in ORDER_DATABASE:
        return {
            "status": "success",
            "found": True,
            "data": ORDER_DATABASE[clean_id]
        }
    
    for key, val in ORDER_DATABASE.items():
        if clean_id in key or key.split("-")[-1] in clean_id:
            return {
                "status": "success",
                "found": True,
                "data": val
            }
    
    # Realistic mock generator for arbitrary order IDs provided by caller
    digits_match = re.search(r'\d{3,6}', clean_id)
    carrier_choices = ["BlueDart Express", "Delhivery Logistics", "Ekart Logistics", "Shadowfax"]
    selected_carrier = carrier_choices[int(time.time()) % len(carrier_choices)]
    mock_order = {
        "order_id": clean_id if clean_id.startswith("ORD-") else f"ORD-{clean_id}",
        "customer_name": "Valued Customer",
        "product": "E-Commerce Package",
        "status": "Out for Delivery",
        "carrier": selected_carrier,
        "tracking_number": f"TRK-{random.randint(10000000, 99999999)}",
        "current_location": "Local City Distribution Hub",
        "dispatched_at": "Today at 06:45 AM",
        "estimated_delivery": "Today by 7:30 PM",
        "delivery_agent": "Local Courier Partner (+91-98XXX-XXXXX)",
        "destination_city": "Destination Address Hub"
    }
    return {
        "status": "success",
        "found": True,
        "data": mock_order
    }


# =====================================================================
# 2. CNH Industrial Telematics & DTC Diagnostic Fault Code Database
# =====================================================================
CNH_DTC_DATABASE: Dict[str, Dict[str, Any]] = {
    "3142": {
        "fault_code": "3142",
        "spn_fmi": "SPN 157 FMI 3",
        "subsystem": "Common Rail High-Pressure Fuel Injection System",
        "component": "Fuel Rail Pressure Sensor Circuit",
        "severity": "High - Engine Derate Active (Power limited to 70%)",
        "tractor_models": "Case IH Magnum 340 / New Holland T8 Genesis / Steyr Terrus CVT",
        "symptoms": "Hard starting, loss of drawbar horsepower, excessive black smoke under heavy load",
        "root_cause": "Rail pressure sensor signal voltage above normal (short circuit to 5V reference or loose connector X-234)",
        "recommended_actions": (
            "1. Inspect wiring harness connector X-234 on engine cylinder head for water intrusion or pin corrosion. "
            "2. Verify fuel rail pressure relief valve has not tripped. "
            "3. Recalibrate pressure sensor via AFS Pro 1200 display under Diagnostics -> Engine Subsystem."
        )
    },
    "1124": {
        "fault_code": "1124",
        "spn_fmi": "SPN 524124 FMI 2",
        "subsystem": "AFS / PLM Precision Guidance & Telematics",
        "component": "VectorPro / Nav-900 GNSS RTK Receiver",
        "severity": "Medium - Auto-Guidance Disengaged",
        "tractor_models": "Case IH Puma / Maxxum / New Holland T7 Series",
        "symptoms": "Auto-guidance autosteer disengages intermittently; 'RTK Correction Lost' prompt on display",
        "root_cause": "Cellular RTK correction stream timeout or UHF radio base-station signal degradation",
        "recommended_actions": (
            "1. Check cellular modem antenna cable on cab roof for physical damage. "
            "2. Confirm NTRIP caster credentials in AFS Pro display under Network Settings. "
            "3. Ensure line-of-sight to local RTK repeater tower."
        )
    },
    "4201": {
        "fault_code": "4201",
        "spn_fmi": "SPN 2631 FMI 7",
        "subsystem": "Electro-Hydraulic Remote (EHR) & Hitch",
        "component": "Hydraulic Remote Valve #1 Spool Position Sensor",
        "severity": "Medium - Valve 1 Floating Locked",
        "tractor_models": "Case IH Optum / New Holland T7 HD",
        "symptoms": "Rear remote #1 lever fails to respond to proportional flow commands",
        "root_cause": "Spool mechanical sticking due to hydraulic oil contamination or solenoid armature binding",
        "recommended_actions": (
            "1. Check main hydraulic filter differential pressure indicator. "
            "2. Execute EHR spool stroke relearn sequence in tractor diagnostic console. "
            "3. Flush hydraulic couplers and inspect O-rings."
        )
    },
    "5200": {
        "fault_code": "5200",
        "spn_fmi": "SPN 639 FMI 9",
        "subsystem": "ISOBUS Implement Gateway & CAN-Bus 2",
        "component": "Rear Implement Breakaway Connector & ISO-Bus Gateway",
        "severity": "Low - Implement Virtual Terminal Offline",
        "tractor_models": "Case IH Steiger / Quadtrac / New Holland T9 Series",
        "symptoms": "Seeder / Planter VT screen missing from display console",
        "root_cause": "CAN-Bus termination resistance anomaly (expected 60 Ohms across CAN-H and CAN-L)",
        "recommended_actions": (
            "1. Inspect 9-pin ISOBUS implement breakaway socket at tractor hitch for bent pins. "
            "2. Measure resistance across pins 2 & 4 using digital multimeter. "
            "3. Power-cycle the master cab battery disconnect switch."
        )
    }
}


def lookup_cnh_dtc_fault(fault_code: str) -> Dict[str, Any]:
    """
    Simulated CNH Industrial telematics fault diagnostics lookup.
    """
    clean_code = str(fault_code).strip().upper().replace("DTC", "").replace("CODE", "").replace("-", "").replace(" ", "")
    
    if clean_code in CNH_DTC_DATABASE:
        return {
            "status": "success",
            "found": True,
            "data": CNH_DTC_DATABASE[clean_code]
        }
    
    # Search partial keys
    for code_k, val in CNH_DTC_DATABASE.items():
        if clean_code in code_k or code_k in clean_code:
            return {
                "status": "success",
                "found": True,
                "data": val
            }
    
    # Intelligent diagnostic generator for unspecified CNH codes
    mock_fault = {
        "fault_code": clean_code or "3142",
        "spn_fmi": f"SPN {clean_code or '3142'} FMI 4",
        "subsystem": "Electronic Diesel Control (EDC) / Engine Management",
        "component": f"Subsystem Sensor Module (Code {clean_code})",
        "severity": "Moderate - Warning Amber Lamp Active",
        "tractor_models": "Case IH / New Holland Agricultural Equipment",
        "symptoms": "Diagnostic warning message on AFS / PLM cabin terminal",
        "root_cause": f"Sensor circuit voltage deviation detected on harness channel {clean_code}",
        "recommended_actions": (
            f"1. Check electrical harness continuity and grounding for sensor unit {clean_code}. "
            "2. Inspect primary and secondary fuel / hydraulic filters. "
            "3. Clear trouble code via AFS Display Diagnostics after completing physical inspection."
        )
    }
    return {
        "status": "success",
        "found": True,
        "data": mock_fault
    }


# =====================================================================
# 3. Live CRM Support Ticket Escalation
# =====================================================================
TICKET_STORE: List[Dict[str, Any]] = []


def create_support_ticket(
    issue_summary: str,
    customer_name: Optional[str] = None,
    priority: str = "High",
    category: Optional[str] = None
) -> Dict[str, Any]:
    """
    Simulated live CRM support ticket creation with escalation SLA tracking.
    """
    ticket_num = random.randint(10000, 99999)
    ticket_id = f"TCK-{ticket_num}"
    created_time = time.strftime("%Y-%m-%d %H:%M:%S")
    
    ticket_data = {
        "ticket_id": ticket_id,
        "issue_summary": issue_summary,
        "customer_name": customer_name or "Valued Customer",
        "priority": priority,
        "category": category or "Technical Support & Telematics",
        "status": "Escalated & Assigned",
        "assigned_team": "L2 Senior Technical Dispatch / Priority Support Team",
        "sla_target": "Callback within 2 hours",
        "created_at": created_time,
        "sms_notification": f"SMS confirmation sent to customer with Ticket Reference #{ticket_id}"
    }
    
    TICKET_STORE.append(ticket_data)
    return {
        "status": "success",
        "ticket_id": ticket_id,
        "data": ticket_data
    }


# =====================================================================
# 4. OpenAI / Groq Function Calling Tool Definitions
# =====================================================================
TOOLS_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_order",
            "description": "Look up live e-commerce order carrier dispatch details, real-time tracking status, and estimated delivery date/time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {
                        "type": "string",
                        "description": "The order ID to query (e.g. ORD-1092, ORD-4821, ORD-9821, 1092)"
                    }
                },
                "required": ["order_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_cnh_dtc_fault",
            "description": "Query CNH Industrial (Case IH & New Holland) agricultural machinery telematics DTC diagnostic trouble code details, component failure root causes, and field remediation steps.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fault_code": {
                        "type": "string",
                        "description": "The diagnostic fault code number (e.g. 3142 for fuel rail sensor, 1124 for RTK GPS, 4201 for hydraulic EHR valve, 5200 for ISOBUS)"
                    }
                },
                "required": ["fault_code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_support_ticket",
            "description": "Escalate and create a live high-priority CRM support ticket for human field technician callback or unresolved logistics / telematics issues.",
            "parameters": {
                "type": "object",
                "properties": {
                    "issue_summary": {
                        "type": "string",
                        "description": "Clear summary of the problem, machine model, or order issue requiring escalation"
                    },
                    "customer_name": {
                        "type": "string",
                        "description": "Name of the customer or machine operator"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["Urgent", "High", "Standard"],
                        "description": "Priority level of the support ticket"
                    }
                },
                "required": ["issue_summary"]
            }
        }
    }
]


def execute_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes a requested external tool by name with arguments.
    """
    try:
        if tool_name == "lookup_order":
            order_id = arguments.get("order_id", "")
            return lookup_order(order_id)
        elif tool_name == "lookup_cnh_dtc_fault":
            fault_code = arguments.get("fault_code", "")
            return lookup_cnh_dtc_fault(fault_code)
        elif tool_name == "create_support_ticket":
            summary = arguments.get("issue_summary", "")
            name = arguments.get("customer_name")
            priority = arguments.get("priority", "High")
            return create_support_ticket(issue_summary=summary, customer_name=name, priority=priority)
        else:
            return {"status": "error", "message": f"Unknown tool: {tool_name}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
