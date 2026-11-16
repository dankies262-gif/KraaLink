FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY KraaLink.csproj ./
RUN dotnet restore KraaLink.csproj
COPY . .
RUN dotnet publish KraaLink.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:10000
ENV KRAALINK_DATA=/tmp/kraalink
ENV KRAALINK_DB=/tmp/kraalink/kraalink.db
ENV KRAALINK_STORAGE=/tmp/kraalink/storage
EXPOSE 10000
ENTRYPOINT ["dotnet", "KraaLink.dll"]
