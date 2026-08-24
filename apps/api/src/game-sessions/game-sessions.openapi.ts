import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMafiaSessionRequest {
  @ApiPropertyOptional({
    minimum: 5,
    maximum: 10,
    default: 5,
    description: 'The total number of Participants, including the Human Player.',
  })
  participantCount?: number;
}

export const mafiaProjectionSchema = {
  type: 'object',
  required: ['eventId', 'sessionId', 'public', 'personal'],
  properties: {
    eventId: { type: 'integer', example: 1 },
    sessionId: { type: 'string', format: 'uuid' },
    public: {
      type: 'object',
      required: ['phase', 'phaseDeadline', 'participants'],
      properties: {
        phase: { type: 'string', example: 'day-discussion' },
        phaseDeadline: { type: 'string', format: 'date-time' },
        participants: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'alive'],
            properties: {
              id: { type: 'string', example: 'participant-1' },
              name: { type: 'string', example: 'You' },
              alive: { type: 'boolean', example: true },
            },
          },
        },
      },
    },
    personal: {
      type: 'object',
      required: ['participantId', 'role', 'allegiance'],
      properties: {
        participantId: { type: 'string', example: 'participant-1' },
        role: { type: 'string', enum: ['Mafia', 'Detective', 'Doctor', 'Citizen'] },
        allegiance: { type: 'string', enum: ['Mafia', 'Citizen'] },
      },
    },
  },
};
