# Scheduled Agent Actions use their scheduled time

A Scheduled Agent Action that was due strictly before its Phase deadline is applied with its scheduled time during durable recovery, even if recovery starts after the deadline. We choose this over discarding the action based on recovery time because durable scheduling preserves a decision made for that Phase; applying it at recovery time would silently lose the action while consuming its pending record.
