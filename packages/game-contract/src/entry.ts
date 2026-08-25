export type GameModule<
  CreateInput,
  PublicInformation extends object,
  PersonalInformation extends object,
> = {
  create(input: CreateInput): GameModuleSession<PublicInformation, PersonalInformation>;
};

export type GameModuleSession<
  PublicInformation extends object,
  PersonalInformation extends object,
> = {
  projectionFor(
    participantId: string,
    eventId: number,
  ): AuthorizedGameProjection<PublicInformation, PersonalInformation>;
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
