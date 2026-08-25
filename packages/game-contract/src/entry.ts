import type { Result } from 'neverthrow';

export type GameModule<
  CreateInput,
  PublicInformation extends object,
  PersonalInformation extends object,
  CreateError,
  ProjectionError,
> = {
  create(
    input: CreateInput,
  ): Result<
    GameModuleSession<PublicInformation, PersonalInformation, ProjectionError>,
    CreateError
  >;
};

export type GameModuleSession<
  PublicInformation extends object,
  PersonalInformation extends object,
  ProjectionError,
> = {
  projectionFor(
    participantId: string,
    eventId: number,
  ): Result<AuthorizedGameProjection<PublicInformation, PersonalInformation>, ProjectionError>;
};

export type AuthorizedGameProjection<
  PublicInformation extends object,
  PersonalInformation extends object,
> = {
  eventId: number;
  sessionId: string;
  public: PublicInformation;
  personal: PersonalInformation;
};
